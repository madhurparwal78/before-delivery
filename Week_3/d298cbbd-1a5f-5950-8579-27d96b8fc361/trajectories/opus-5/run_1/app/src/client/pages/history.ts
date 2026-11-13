import { api, type HistoryResponse, type HistoryRun } from '../api.js';
import { COPY, percent, two, utcMinute } from '../copy.js';
import { el } from '../dom.js';
import type { Page } from '../router.js';
import { replaceQuery } from '../router.js';
import { state } from '../state.js';
import { heading } from '../shell.js';

const MODE_LENGTHS: Record<string, string[]> = {
  time: ['15', '30', '60', '120'],
  words: ['10', '25', '50', '100'],
  quote: ['short', 'medium', 'long', 'all'],
};

const COLUMNS = ['Date', 'Mode', 'Length', 'Speed', 'Raw', 'Accuracy', 'Consistency', 'Verdict'];

function verdictText(verdict: string): string {
  return verdict === 'counted' ? 'Counted' : 'Not counted';
}

function cells(run: HistoryRun): string[] {
  return [
    utcMinute(run.finishedAt),
    run.mode,
    run.length === null ? '-' : String(run.length),
    two(run.speed),
    two(run.raw),
    percent(run.accuracy),
    percent(run.consistency),
    verdictText(run.verdict),
  ];
}

export class HistoryPage implements Page {
  private readonly table = el('div', { class: 'history-holder' });
  private runs: HistoryRun[] = [];
  private more = false;
  private customLengths: number[] = [];
  private page = 1;
  private mode = '';
  private length = '';
  private verdict = '';
  private readonly onResize = (): void => this.paint();

  async render(container: HTMLElement): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.mode = params.get('mode') ?? '';
    this.length = params.get('length') ?? '';
    this.verdict = params.get('verdict') ?? '';

    container.textContent = '';
    const folder = el('div', { class: 'folder open ledger' });
    folder.append(heading(1, 'History'));
    folder.append(this.filters());
    folder.append(this.table);
    container.append(folder);
    window.addEventListener('resize', this.onResize);
    if (!state.session) {
      this.table.replaceChildren(
        el('p', {}, ['Sign in to see your runs.']),
        el('a', { href: '/signin', class: 'link' }, ['Sign in']),
      );
      return;
    }
    await this.load(1);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }

  private select(
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
  ): HTMLElement {
    const field = el('select', { class: 'select', 'aria-label': label }) as HTMLSelectElement;
    for (const option of options) {
      const node = el('option', { value: option.value }, [option.label]) as HTMLOptionElement;
      if (option.value === value) node.selected = true;
      field.append(node);
    }
    field.addEventListener('change', () => onChange(field.value));
    return el('label', { class: 'field' }, [el('span', {}, [label]), field]);
  }

  private filters(): HTMLElement {
    const lengthOptions = [{ value: '', label: 'All' }];
    if (this.mode === 'custom') {
      for (const count of this.customLengths) {
        lengthOptions.push({ value: String(count), label: String(count) });
      }
    } else if (this.mode !== '') {
      for (const value of MODE_LENGTHS[this.mode] ?? []) {
        lengthOptions.push({ value, label: value });
      }
    }
    const row = el('div', { class: 'filter-row' }, [
      this.select(
        'Mode',
        [
          { value: '', label: 'All' },
          { value: 'time', label: 'time' },
          { value: 'words', label: 'words' },
          { value: 'quote', label: 'quote' },
          { value: 'custom', label: 'custom' },
        ],
        this.mode,
        (value) => {
          this.mode = value;
          this.length = '';
          void this.load(1);
        },
      ),
      this.select('Length', lengthOptions, this.length, (value) => {
        this.length = value;
        void this.load(1);
      }),
      this.select(
        'Verdict',
        [
          { value: '', label: 'All' },
          { value: 'counted', label: 'Counted' },
          { value: 'not_counted', label: 'Not counted' },
        ],
        this.verdict,
        (value) => {
          this.verdict = value;
          void this.load(1);
        },
      ),
    ]);
    this.filterRow.replaceChildren(row);
    return this.filterRow;
  }

  private readonly filterRow = el('div', { class: 'filters' });

  private query(page: number): string {
    const params = new URLSearchParams();
    if (this.mode) params.set('mode', this.mode);
    if (this.length) params.set('length', this.length);
    if (this.verdict) params.set('verdict', this.verdict);
    const search = params.toString();
    replaceQuery(search);
    const withPage = new URLSearchParams(params);
    withPage.set('page', String(page));
    return withPage.toString();
  }

  private async load(page: number): Promise<void> {
    const holder = this.table.querySelector('[aria-busy]');
    holder?.setAttribute('aria-busy', 'true');
    const query = this.query(page);
    const response = await api.get<HistoryResponse>(`/api/history?${query}`);
    if (response.status !== 200 || !response.body) {
      this.table.replaceChildren(el('p', { role: 'alert', class: 'alert' }, [COPY.serverError]));
      return;
    }
    this.page = page;
    this.runs = page === 1 ? response.body.runs : [...this.runs, ...response.body.runs];
    this.more = response.body.more;
    this.customLengths = response.body.customLengths;
    this.filters();
    this.paint();
  }

  private paint(): void {
    if (this.runs.length === 0) {
      this.table.replaceChildren(el('p', { class: 'empty-sheet' }, [COPY.emptyHistory]));
      return;
    }
    const phone = window.innerWidth < 768;
    const nodes: HTMLElement[] = [];
    if (phone) {
      const list = el('ul', { role: 'list', 'aria-label': 'History', class: 'card-list', 'aria-busy': 'false' });
      for (const run of this.runs) {
        const card = el('li', { class: 'index-card' });
        cells(run).forEach((value, index) => {
          card.append(
            el('p', { class: 'card-field' }, [
              el('span', { class: 'card-label' }, [COLUMNS[index] as string]),
              el('span', { class: 'card-value' }, [value]),
            ]),
          );
        });
        card.append(el('a', { href: `/runs/${run.runId}`, class: 'link' }, ['Open run']));
        list.append(card);
      }
      nodes.push(list);
    } else {
      const table = el('table', { class: 'data-table', 'aria-busy': 'false' });
      table.append(el('caption', {}, ['History']));
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            ...COLUMNS.map((column) => el('th', { scope: 'col' }, [column])),
            el('th', { scope: 'col' }, ['Run']),
          ]),
        ]),
      );
      const body = el('tbody');
      for (const run of this.runs) {
        body.append(
          el('tr', {}, [
            ...cells(run).map((value) => el('td', {}, [value])),
            el('td', {}, [el('a', { href: `/runs/${run.runId}`, class: 'link' }, ['Open run'])]),
          ]),
        );
      }
      table.append(body);
      nodes.push(table);
    }
    if (this.more) {
      const older = el('button', { type: 'button', class: 'button' }, ['Older runs']);
      older.addEventListener('click', () => {
        void this.load(this.page + 1);
      });
      nodes.push(older);
    }
    this.table.replaceChildren(...nodes);
  }
}
