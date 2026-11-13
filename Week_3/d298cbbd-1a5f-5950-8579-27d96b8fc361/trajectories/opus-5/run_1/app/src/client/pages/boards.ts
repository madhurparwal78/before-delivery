import { api, type BoardRow } from '../api.js';
import { COPY, boardChangeLine, percent, two, utcDate } from '../copy.js';
import { el } from '../dom.js';
import { tabList } from '../controls.js';
import type { Page } from '../router.js';
import { state } from '../state.js';
import { heading } from '../shell.js';

interface BoardEvent {
  board: string;
  length: string;
  rows: BoardRow[];
  change: { name: string; rank: number; speed: number } | null;
}

export class BoardsPage implements Page {
  private board = 'daily';
  private length = '15';
  private readonly tableHolder = el('div', { class: 'board-holder' });
  private readonly updates = el('div', {
    role: 'status',
    'aria-label': 'Board updates',
    class: 'visually-hidden',
  });
  private stream: EventSource | null = null;

  async render(container: HTMLElement): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.board = params.get('board') === 'alltime' ? 'alltime' : 'daily';
    this.length = params.get('length') === '60' ? '60' : '15';

    container.textContent = '';
    const folder = el('div', { class: 'folder open pinned' });
    folder.append(heading(1, 'Leaderboards'));
    folder.append(
      tabList({
        label: 'Board',
        tabs: [
          { value: 'daily', label: 'Daily' },
          { value: 'alltime', label: 'All-time' },
        ],
        value: this.board,
        onChange: (value) => {
          this.board = value;
          this.sync();
        },
      }),
      tabList({
        label: 'Length',
        tabs: [
          { value: '15', label: '15 seconds' },
          { value: '60', label: '60 seconds' },
        ],
        value: this.length,
        onChange: (value) => {
          this.length = value;
          this.sync();
        },
      }),
      this.tableHolder,
      this.updates,
    );
    container.append(folder);
    await this.load();
    this.listen();
  }

  dispose(): void {
    this.stream?.close();
    this.stream = null;
  }

  private sync(): void {
    window.history.replaceState(
      null,
      '',
      `/boards?board=${this.board}&length=${this.length}`,
    );
    void this.load();
    this.listen();
  }

  private async load(): Promise<void> {
    const response = await api.get<{ rows: BoardRow[] }>(
      `/api/boards?board=${this.board}&length=${this.length}`,
    );
    if (response.status === 200 && response.body) this.paint(response.body.rows);
  }

  private listen(): void {
    this.stream?.close();
    const stream = new EventSource(`/api/live/board?board=${this.board}&length=${this.length}`);
    this.stream = stream;
    stream.addEventListener('board', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as BoardEvent;
      if (payload.board !== this.board || payload.length !== this.length) return;
      this.paint(payload.rows);
      if (payload.change) {
        this.updates.textContent = boardChangeLine(
          payload.change.name,
          payload.change.rank,
          payload.change.speed,
        );
      }
    });
  }

  private paint(rows: BoardRow[]): void {
    const table = el('table', { class: 'data-table board-table' });
    table.append(el('caption', {}, ['Leaderboard']));
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Rank']),
          el('th', { scope: 'col' }, ['Typist']),
          el('th', { scope: 'col' }, ['Speed']),
          el('th', { scope: 'col' }, ['Accuracy']),
          el('th', { scope: 'col' }, ['Date']),
        ]),
      ]),
    );
    const body = el('tbody');
    for (const row of rows) {
      const own = state.session !== null && row.name === state.session.name;
      body.append(
        el('tr', own ? { 'aria-current': 'true' } : {}, [
          el('td', {}, [String(row.rank)]),
          el('td', {}, [row.name]),
          el('td', {}, [two(row.speed)]),
          el('td', {}, [percent(row.accuracy)]),
          el('td', {}, [utcDate(row.finishedAt)]),
        ]),
      );
    }
    table.append(body);
    if (rows.length === 0) {
      this.tableHolder.replaceChildren(table, el('p', { class: 'empty-sheet' }, [COPY.emptyBoard]));
      return;
    }
    this.tableHolder.replaceChildren(table);
  }
}
